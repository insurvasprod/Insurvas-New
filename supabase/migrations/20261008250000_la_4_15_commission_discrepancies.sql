-- LA-4.15 (Notion sprint) · the discrepancy engine and dispute letters, on the carrier-file ledger.
--
-- One list: money owed to the agent, money that will be taken back, money held, and exactly why.
-- Nine types (five need no rate card):
--   missing · short_paid · over_paid · mis_rated · duplicate_chargeback · unexpected_chargeback ·
--   missing_chargeback · held_building_up · debit_balance_growing
-- The engine (lib/ingestion/discrepancyEngine.ts) runs after every carrier file; this table keeps
-- its findings STABLE: one row per (agency, carrier, type, subject, policy year), updated on every
-- run, never duplicated. A problem that stops being found resolves itself, with a note saying so.
-- Every row carries its evidence: the expected figure and the rate row behind it, the reported
-- figure and the ledger entries (and so file lines) behind it, the difference and the tolerance.
--
--   commission_discrepancy   written by record_discrepancy_run (findings) and
--                            set_discrepancy_status (a person's decision) only.
--   commission_dispute       a letter: drafted by us from the records, SENT BY THE AGENT. Its
--                            body is frozen when drafted, so the figures argued are the figures kept.
--                            The outcome (accepted / rejected / partial, with the amount credited)
--                            builds each carrier's dispute record.
--
-- The earlier module (tenant_commission_discrepancies, LA-4 2026-10) stays for imported statements.
--
-- Additive. Requires 20261008230000 (expected_commission), 20261008240000 (carrier accounts).
--
-- Rollback:
--   drop function if exists public.record_discrepancy_run(uuid, uuid, jsonb), public.set_discrepancy_status(uuid, uuid, uuid, text, text);
--   drop table if exists public.commission_dispute, public.commission_discrepancy;

create table if not exists public.commission_discrepancy (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  discrepancy_type text not null,
  -- The policy number, or '*' for an account-level finding (held, debit balance).
  subject_key text not null,
  policy_number text,
  policy_year integer not null default 1,
  severity text not null,
  status text not null default 'open',
  expected_amount_cents bigint,
  expected_source jsonb,
  reported_amount_cents bigint,
  reported_entry_ids uuid[] not null default '{}',
  difference_cents bigint,
  tolerance_applied_cents bigint,
  explanation text not null,
  evidence jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  detection_run_id uuid not null,
  resolution text,
  resolution_note text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  dispute_id uuid,
  constraint commission_discrepancy_key unique (tenant_id, carrier_id, discrepancy_type, subject_key, policy_year),
  constraint commission_discrepancy_type check (discrepancy_type in ('missing', 'short_paid', 'over_paid', 'mis_rated', 'duplicate_chargeback', 'unexpected_chargeback', 'missing_chargeback', 'held_building_up', 'debit_balance_growing')),
  constraint commission_discrepancy_severity check (severity in ('info', 'warning', 'action')),
  constraint commission_discrepancy_status check (status in ('open', 'disputed', 'resolved', 'dismissed', 'expired')),
  constraint commission_discrepancy_closed check ((status in ('open', 'disputed')) = (resolved_at is null)),
  constraint commission_discrepancy_subject check ((subject_key = '*') = (policy_number is null)),
  constraint commission_discrepancy_note check (resolution_note is null or char_length(resolution_note) <= 2000),
  constraint commission_discrepancy_explanation check (char_length(explanation) between 1 and 2000)
);
create index if not exists commission_discrepancy_open_idx on public.commission_discrepancy (tenant_id, status, severity);
create index if not exists commission_discrepancy_carrier_idx on public.commission_discrepancy (carrier_id);
create index if not exists commission_discrepancy_policy_idx on public.commission_discrepancy (tenant_id, carrier_id, policy_number) where policy_number is not null;
create index if not exists commission_discrepancy_resolved_by_idx on public.commission_discrepancy (resolved_by) where resolved_by is not null;
create index if not exists commission_discrepancy_dispute_idx on public.commission_discrepancy (dispute_id) where dispute_id is not null;

create table if not exists public.commission_dispute (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  discrepancy_ids uuid[] not null,
  recipient text,
  letter_body text not null,
  total_cents bigint not null,
  status text not null default 'draft',
  sent_at timestamptz,
  sent_via text,
  outcome_amount_cents bigint,
  resolved_at timestamptz,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_dispute_items check (cardinality(discrepancy_ids) between 1 and 200),
  constraint commission_dispute_status check (status in ('draft', 'sent', 'acknowledged', 'accepted', 'rejected', 'partial')),
  constraint commission_dispute_sent check ((status = 'draft') = (sent_at is null) and (sent_at is null) = (sent_via is null)),
  constraint commission_dispute_via check (sent_via is null or sent_via in ('email', 'portal', 'post')),
  constraint commission_dispute_outcome check (
    (status in ('accepted', 'rejected', 'partial')) = (resolved_at is not null)
    and (status <> 'partial' or (outcome_amount_cents is not null and outcome_amount_cents > 0))
    and (status <> 'rejected' or coalesce(outcome_amount_cents, 0) = 0)
  ),
  constraint commission_dispute_text check (char_length(letter_body) between 1 and 40000 and (recipient is null or char_length(recipient) <= 1000) and (notes is null or char_length(notes) <= 4000))
);
create index if not exists commission_dispute_tenant_idx on public.commission_dispute (tenant_id, carrier_id, created_at desc);
create index if not exists commission_dispute_carrier_idx on public.commission_dispute (carrier_id);
create index if not exists commission_dispute_created_by_idx on public.commission_dispute (created_by) where created_by is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commission_discrepancy_dispute_fkey') then
    alter table public.commission_discrepancy add constraint commission_discrepancy_dispute_fkey foreign key (dispute_id) references public.commission_dispute(id) on delete set null;
  end if;
end $$;

-- The letter that went out is the letter we keep: once sent, its body and items never change.
create or replace function public.commission_dispute_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'A dispute that was sent is kept.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (new.letter_body is distinct from old.letter_body or new.discrepancy_ids is distinct from old.discrepancy_ids
     or new.total_cents is distinct from old.total_cents or new.carrier_id is distinct from old.carrier_id) then
    raise exception 'A sent dispute letter never changes; draft a new one.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists commission_dispute_guard on public.commission_dispute;
create trigger commission_dispute_guard before update or delete on public.commission_dispute
  for each row execute function public.commission_dispute_guard();

-- ─── the engine's writer ────────────────────────────────────────────────────────────────────────
-- p_findings: [{ carrier_id, discrepancy_type, subject_key, policy_number, policy_year, severity,
--   expected_amount_cents, expected_source, reported_amount_cents, reported_entry_ids,
--   difference_cents, tolerance_applied_cents, explanation, evidence }] — every finding of this
-- agency in this run. Open and disputed rows not found again resolve themselves; a dismissed row
-- stays dismissed; a resolved row whose problem returns opens again.
create or replace function public.record_discrepancy_run(p_tenant_id uuid, p_run_id uuid, p_findings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opened integer := 0;
  v_updated integer := 0;
  v_reopened integer := 0;
  v_cleared integer := 0;
begin
  if jsonb_typeof(coalesce(p_findings, '[]'::jsonb)) <> 'array' then
    raise exception 'record_discrepancy_run: findings must be an array' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('commission_discrepancy:' || p_tenant_id::text, 0));

  create temp table if not exists pg_temp.found (
    carrier_id uuid, discrepancy_type text, subject_key text, policy_number text, policy_year integer, severity text,
    expected_amount_cents bigint, expected_source jsonb, reported_amount_cents bigint, reported_entry_ids uuid[],
    difference_cents bigint, tolerance_applied_cents bigint, explanation text, evidence jsonb
  ) on commit drop;
  truncate pg_temp.found;
  insert into pg_temp.found
  select f.carrier_id, f.discrepancy_type, f.subject_key, f.policy_number, coalesce(f.policy_year, 1), f.severity,
         f.expected_amount_cents, f.expected_source, f.reported_amount_cents, coalesce(f.reported_entry_ids, '{}'),
         f.difference_cents, f.tolerance_applied_cents, f.explanation, coalesce(f.evidence, '{}'::jsonb)
    from jsonb_to_recordset(coalesce(p_findings, '[]'::jsonb)) as f(
      carrier_id uuid, discrepancy_type text, subject_key text, policy_number text, policy_year integer, severity text,
      expected_amount_cents bigint, expected_source jsonb, reported_amount_cents bigint, reported_entry_ids uuid[],
      difference_cents bigint, tolerance_applied_cents bigint, explanation text, evidence jsonb);

  -- Found again: the figures move with the evidence; a dismissed one stays dismissed; a resolved one
  -- opens again. Counted against each row's status from before this run.
  with prior as (
    select d.id, d.status as old_status from public.commission_discrepancy d
      join pg_temp.found f on d.carrier_id = f.carrier_id and d.discrepancy_type = f.discrepancy_type and d.subject_key = f.subject_key and d.policy_year = f.policy_year
     where d.tenant_id = p_tenant_id
  ), upd as (
    update public.commission_discrepancy d set
      severity = f.severity, expected_amount_cents = f.expected_amount_cents, expected_source = f.expected_source,
      reported_amount_cents = f.reported_amount_cents, reported_entry_ids = f.reported_entry_ids, difference_cents = f.difference_cents,
      tolerance_applied_cents = f.tolerance_applied_cents, explanation = f.explanation, evidence = f.evidence,
      last_seen_at = now(), detection_run_id = p_run_id,
      status = case when d.status in ('resolved', 'expired') then 'open' else d.status end,
      resolution = case when d.status in ('resolved', 'expired') then null else d.resolution end,
      resolution_note = case when d.status in ('resolved', 'expired') then 'Found again after it had resolved.' else d.resolution_note end,
      resolved_by = case when d.status in ('resolved', 'expired') then null else d.resolved_by end,
      resolved_at = case when d.status in ('resolved', 'expired') then null else d.resolved_at end
      from pg_temp.found f
     where d.tenant_id = p_tenant_id and d.carrier_id = f.carrier_id and d.discrepancy_type = f.discrepancy_type
       and d.subject_key = f.subject_key and d.policy_year = f.policy_year
    returning d.id
  )
  select count(*) filter (where p.old_status not in ('resolved', 'expired')), count(*) filter (where p.old_status in ('resolved', 'expired'))
    into v_updated, v_reopened from upd join prior p on p.id = upd.id;
  with ins as (
    insert into public.commission_discrepancy (tenant_id, carrier_id, discrepancy_type, subject_key, policy_number, policy_year, severity,
      expected_amount_cents, expected_source, reported_amount_cents, reported_entry_ids, difference_cents, tolerance_applied_cents,
      explanation, evidence, detection_run_id)
    select p_tenant_id, f.carrier_id, f.discrepancy_type, f.subject_key, f.policy_number, f.policy_year, f.severity,
           f.expected_amount_cents, f.expected_source, f.reported_amount_cents, f.reported_entry_ids, f.difference_cents, f.tolerance_applied_cents,
           f.explanation, f.evidence, p_run_id
      from pg_temp.found f
     where not exists (select 1 from public.commission_discrepancy d where d.tenant_id = p_tenant_id and d.carrier_id = f.carrier_id
                        and d.discrepancy_type = f.discrepancy_type and d.subject_key = f.subject_key and d.policy_year = f.policy_year)
    returning 1
  )
  select count(*) into v_opened from ins;

  -- Not found this run: it resolved itself (the commission arrived, the balance recovered…).
  with gone as (
    update public.commission_discrepancy d set status = 'resolved', resolution = 'cleared_itself',
           resolution_note = case d.discrepancy_type
             when 'missing' then 'Resolved itself: the commission arrived.'
             when 'missing_chargeback' then 'Resolved itself: the chargeback was taken, or the policy recovered.'
             when 'debit_balance_growing' then 'Resolved itself: the debit balance stopped growing.'
             when 'held_building_up' then 'Resolved itself: the held money was paid out or stopped growing.'
             else 'Resolved itself: the latest files no longer show it.' end,
           resolved_at = now(), resolved_by = null
     where d.tenant_id = p_tenant_id and d.status in ('open', 'disputed')
       and not exists (select 1 from pg_temp.found f where f.carrier_id = d.carrier_id and f.discrepancy_type = d.discrepancy_type
                        and f.subject_key = d.subject_key and f.policy_year = d.policy_year)
    returning 1
  )
  select count(*) into v_cleared from gone;

  return jsonb_build_object('opened', v_opened, 'updated', v_updated, 'reopened', v_reopened, 'cleared', v_cleared);
end;
$$;

-- A person's decision on one finding: dismiss it (with why), or open it again.
create or replace function public.set_discrepancy_status(p_tenant_id uuid, p_id uuid, p_user_id uuid, p_status text, p_note text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('open', 'dismissed', 'resolved') then
    raise exception 'set_discrepancy_status: a person opens, dismisses or resolves' using errcode = '22023';
  end if;
  update public.commission_discrepancy set status = p_status,
         resolution = case p_status when 'open' then null when 'dismissed' then 'dismissed' else 'resolved_by_person' end,
         resolution_note = case when p_status = 'open' then null else nullif(btrim(coalesce(p_note, '')), '') end,
         resolved_by = case when p_status = 'open' then null else p_user_id end,
         resolved_at = case when p_status = 'open' then null else now() end
   where id = p_id and tenant_id = p_tenant_id and status <> 'disputed';
  return found;
end;
$$;

-- ─── access ─────────────────────────────────────────────────────────────────────────────────────
alter table public.commission_discrepancy enable row level security;
alter table public.commission_dispute enable row level security;
drop policy if exists commission_discrepancy_read on public.commission_discrepancy;
create policy commission_discrepancy_read on public.commission_discrepancy for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists commission_dispute_read on public.commission_dispute;
create policy commission_dispute_read on public.commission_dispute for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
revoke all on public.commission_discrepancy, public.commission_dispute from public, anon, authenticated;
-- Findings are written by the two functions only; disputes are the agency's (drafted, sent, settled).
revoke insert, update, delete, truncate on public.commission_discrepancy from service_role, tenant_app;
revoke truncate on public.commission_dispute from service_role, tenant_app;
grant select on public.commission_discrepancy to service_role, tenant_app;
grant select, insert, update, delete on public.commission_dispute to service_role;
grant select on public.commission_dispute to tenant_app;
-- Marking findings disputed when a letter is drafted goes through this one narrow function too.
create or replace function public.attach_dispute(p_tenant_id uuid, p_dispute_id uuid, p_ids uuid[], p_status text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v integer;
begin
  if p_status = 'disputed' then
    update public.commission_discrepancy set status = 'disputed', dispute_id = p_dispute_id
     where tenant_id = p_tenant_id and id = any(p_ids) and status = 'open';
  elsif p_status in ('resolved', 'open') then
    update public.commission_discrepancy set status = p_status,
           resolution = case when p_status = 'resolved' then 'dispute_settled' else null end,
           resolution_note = case when p_status = 'resolved' then 'Settled by the dispute letter.' else 'The carrier rejected the dispute.' end,
           resolved_at = case when p_status = 'resolved' then now() else null end
     where tenant_id = p_tenant_id and dispute_id = p_dispute_id and status = 'disputed';
  else
    raise exception 'attach_dispute: disputed, resolved or open' using errcode = '22023';
  end if;
  get diagnostics v = row_count;
  return v;
end;
$$;
revoke all on function public.record_discrepancy_run(uuid, uuid, jsonb), public.set_discrepancy_status(uuid, uuid, uuid, text, text), public.attach_dispute(uuid, uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.record_discrepancy_run(uuid, uuid, jsonb), public.set_discrepancy_status(uuid, uuid, uuid, text, text), public.attach_dispute(uuid, uuid, uuid[], text) to service_role;

do $$
begin
  if has_table_privilege('service_role', 'public.commission_discrepancy', 'INSERT') or has_table_privilege('service_role', 'public.commission_discrepancy', 'UPDATE')
     or has_table_privilege('service_role', 'public.commission_discrepancy', 'DELETE') then
    raise exception '20261008250000: discrepancies must be written only by their functions (service_role still has insert=%, update=%, delete=%)',
      has_table_privilege('service_role', 'public.commission_discrepancy', 'INSERT'), has_table_privilege('service_role', 'public.commission_discrepancy', 'UPDATE'),
      has_table_privilege('service_role', 'public.commission_discrepancy', 'DELETE');
  end if;
end $$;
