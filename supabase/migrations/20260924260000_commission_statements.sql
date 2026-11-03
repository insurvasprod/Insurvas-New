-- Book of Business › Statements: carrier commission statements, their lines, and the matches a
-- person accepted.
--
-- The commission ledger's board says "Nothing is recorded automatically without a source. Every
-- entry will keep the statement it came from, the policy it matched and who accepted the match."
-- These tables are that sentence:
--
--   tenant_commission_statements        one uploaded file: carrier, period, who uploaded it, the
--                                       file's name and SHA-256, the column mapping used. Never
--                                       deleted; a wrong import is VOIDED with a reason.
--   tenant_commission_statement_lines   one row of that file, kept verbatim in `raw`, plus what
--                                       was read out of it (policy number, insured, amount, kind,
--                                       date). A row that could not be read keeps its error and
--                                       stays visible; it never posts.
--   tenant_commission_statement_matches line → tenant_policies row. `exact` proposals are made by
--                                       the import (policy number + carrier); `manual` ones by a
--                                       person. Only an ACCEPTED match posts, and it records
--                                       accepted_by / accepted_at.
--   tenant_statement_column_mappings    the column mapping last used per carrier, so the second
--                                       statement from a carrier needs no mapping.
--
-- Two views read them: tenant_commission_statement_entries (accepted lines on statements that
-- are not voided — what the ledger posts) and tenant_commission_statement_summaries (per-statement
-- line counts for the history list).
--
-- Written by the service role after the API has checked the caller (owner or bookkeeper, with the
-- statement_ingestion feature and full access); the tenant plane may read its own tenant's rows.
-- No role is granted DELETE on any of the three record tables: "never delete statements" is a
-- privilege, not a convention. (Tenant removal still cascades: FK actions run as the table owner.)
--
-- Additive and idempotent. The import and review functions are in 20260924260100.

-- ── statements ────────────────────────────────────────────────────────────────
create table if not exists public.tenant_commission_statements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  original_filename text not null,
  file_sha256 text not null,
  headers jsonb not null default '[]'::jsonb,
  column_mapping jsonb not null default '{}'::jsonb,
  row_count integer not null,
  status text not null default 'review',
  uploaded_by uuid references public.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  void_reason text,
  voided_by uuid references public.users(id) on delete set null,
  voided_at timestamptz,
  constraint tenant_commission_statements_period check (period_end >= period_start),
  constraint tenant_commission_statements_filename check (char_length(btrim(original_filename)) between 1 and 255),
  constraint tenant_commission_statements_sha256 check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint tenant_commission_statements_headers check (jsonb_typeof(headers) = 'array'),
  constraint tenant_commission_statements_mapping check (jsonb_typeof(column_mapping) = 'object'),
  constraint tenant_commission_statements_row_count check (row_count between 0 and 10000),
  constraint tenant_commission_statements_status check (status in ('review', 'reviewed', 'voided')),
  constraint tenant_commission_statements_void_complete check (
    (status = 'voided') = (voided_at is not null)
    and (status <> 'voided' or char_length(btrim(coalesce(void_reason, ''))) between 3 and 500)
  )
);

create index if not exists tenant_commission_statements_tenant_uploaded_idx
  on public.tenant_commission_statements (tenant_id, uploaded_at desc);
create index if not exists tenant_commission_statements_carrier_idx
  on public.tenant_commission_statements (carrier_id);
create index if not exists tenant_commission_statements_uploaded_by_idx
  on public.tenant_commission_statements (uploaded_by);
create index if not exists tenant_commission_statements_voided_by_idx
  on public.tenant_commission_statements (voided_by);
-- Duplicate detection: the same file for the same carrier and period is refused while the first
-- import stands. Voiding the first import is how a corrected re-import is allowed.
create unique index if not exists tenant_commission_statements_no_duplicate_idx
  on public.tenant_commission_statements (tenant_id, carrier_id, period_start, period_end, file_sha256)
  where status <> 'voided';

-- ── lines ─────────────────────────────────────────────────────────────────────
create table if not exists public.tenant_commission_statement_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  statement_id uuid not null references public.tenant_commission_statements(id) on delete cascade,
  line_number integer not null,
  raw jsonb not null,
  policy_number text,
  insured_name text,
  amount_cents bigint,
  kind text,
  line_date date,
  parse_error text,
  review_status text not null default 'unmatched',
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_commission_statement_lines_unique_line unique (statement_id, line_number),
  constraint tenant_commission_statement_lines_line_number check (line_number >= 1),
  constraint tenant_commission_statement_lines_raw check (jsonb_typeof(raw) = 'object'),
  constraint tenant_commission_statement_lines_policy_number check (policy_number is null or char_length(policy_number) <= 120),
  constraint tenant_commission_statement_lines_insured check (insured_name is null or char_length(insured_name) <= 200),
  constraint tenant_commission_statement_lines_kind check (kind is null or kind in ('advance', 'commission', 'chargeback', 'adjustment')),
  constraint tenant_commission_statement_lines_review_status check (review_status in ('proposed', 'accepted', 'unmatched', 'left_unmatched', 'error')),
  -- An unreadable row is exactly the rows with an error, and every other row has an amount and a kind.
  constraint tenant_commission_statement_lines_error_is_unpostable check ((review_status = 'error') = (parse_error is not null)),
  constraint tenant_commission_statement_lines_postable_is_complete check (review_status = 'error' or (amount_cents is not null and kind is not null))
);

create index if not exists tenant_commission_statement_lines_tenant_status_idx
  on public.tenant_commission_statement_lines (tenant_id, review_status);
create index if not exists tenant_commission_statement_lines_reviewed_by_idx
  on public.tenant_commission_statement_lines (reviewed_by);

-- ── matches ───────────────────────────────────────────────────────────────────
create table if not exists public.tenant_commission_statement_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  line_id uuid not null references public.tenant_commission_statement_lines(id) on delete cascade,
  policy_id uuid not null references public.tenant_policies(id) on delete restrict,
  method text not null,
  status text not null default 'proposed',
  proposed_by uuid references public.users(id) on delete set null,
  proposed_at timestamptz not null default now(),
  accepted_by uuid references public.users(id) on delete set null,
  accepted_at timestamptz,
  rejected_by uuid references public.users(id) on delete set null,
  rejected_at timestamptz,
  constraint tenant_commission_statement_matches_method check (method in ('exact', 'manual')),
  constraint tenant_commission_statement_matches_status check (status in ('proposed', 'accepted', 'rejected')),
  constraint tenant_commission_statement_matches_accepted_complete check ((status = 'accepted') = (accepted_at is not null)),
  constraint tenant_commission_statement_matches_rejected_complete check ((status = 'rejected') = (rejected_at is not null)),
  -- A person choosing a policy by hand IS the acceptance; only the import proposes.
  constraint tenant_commission_statement_matches_manual_is_decided check (method = 'exact' or status <> 'proposed')
);

-- One live match per line. Rejected proposals are kept as history beside it.
create unique index if not exists tenant_commission_statement_matches_one_live_idx
  on public.tenant_commission_statement_matches (line_id)
  where status <> 'rejected';
create index if not exists tenant_commission_statement_matches_line_idx
  on public.tenant_commission_statement_matches (line_id);
create index if not exists tenant_commission_statement_matches_tenant_status_idx
  on public.tenant_commission_statement_matches (tenant_id, status);
create index if not exists tenant_commission_statement_matches_policy_idx
  on public.tenant_commission_statement_matches (policy_id);
create index if not exists tenant_commission_statement_matches_proposed_by_idx
  on public.tenant_commission_statement_matches (proposed_by);
create index if not exists tenant_commission_statement_matches_accepted_by_idx
  on public.tenant_commission_statement_matches (accepted_by);
create index if not exists tenant_commission_statement_matches_rejected_by_idx
  on public.tenant_commission_statement_matches (rejected_by);

-- ── remembered column mappings ────────────────────────────────────────────────
create table if not exists public.tenant_statement_column_mappings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  carrier_id uuid not null references public.carriers(id) on delete cascade,
  mapping jsonb not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, carrier_id),
  constraint tenant_statement_column_mappings_mapping check (jsonb_typeof(mapping) = 'object')
);
create index if not exists tenant_statement_column_mappings_carrier_idx
  on public.tenant_statement_column_mappings (carrier_id);
create index if not exists tenant_statement_column_mappings_updated_by_idx
  on public.tenant_statement_column_mappings (updated_by);

-- ── what a record may not become ──────────────────────────────────────────────
-- The source of a ledger entry does not change after the fact. A statement's identity, a line's
-- verbatim row and what was read from it, and a match's line/policy/method are fixed at insert; a
-- voided statement stays voided; an accepted or rejected match stays decided. Corrections are a
-- void and a re-import, which leaves both on the record.
create or replace function public.guard_commission_statement_records()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'tenant_commission_statements' then
    if new.tenant_id <> old.tenant_id or new.carrier_id <> old.carrier_id
       or new.period_start <> old.period_start or new.period_end <> old.period_end
       or new.original_filename <> old.original_filename or new.file_sha256 <> old.file_sha256
       or new.headers <> old.headers or new.row_count <> old.row_count
       or new.uploaded_at <> old.uploaded_at then
      raise exception 'A commission statement''s source cannot be changed after import' using errcode = '55000';
    end if;
    if old.status = 'voided' and (new.status <> 'voided' or new.void_reason is distinct from old.void_reason) then
      raise exception 'A voided commission statement stays voided' using errcode = '55000';
    end if;
  elsif tg_table_name = 'tenant_commission_statement_lines' then
    if new.tenant_id <> old.tenant_id or new.statement_id <> old.statement_id or new.line_number <> old.line_number
       or new.raw <> old.raw or new.policy_number is distinct from old.policy_number
       or new.insured_name is distinct from old.insured_name or new.amount_cents is distinct from old.amount_cents
       or new.kind is distinct from old.kind or new.line_date is distinct from old.line_date
       or new.parse_error is distinct from old.parse_error then
      raise exception 'A statement line is kept as imported' using errcode = '55000';
    end if;
    if old.review_status = 'accepted' and new.review_status <> 'accepted' then
      raise exception 'An accepted statement line stays accepted; void the statement to correct it' using errcode = '55000';
    end if;
  elsif tg_table_name = 'tenant_commission_statement_matches' then
    if new.tenant_id <> old.tenant_id or new.line_id <> old.line_id or new.policy_id <> old.policy_id or new.method <> old.method then
      raise exception 'A statement match cannot be pointed somewhere else; reject it and match again' using errcode = '55000';
    end if;
    if old.status <> 'proposed' and new.status <> old.status then
      raise exception 'A decided statement match stays decided' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_commission_statements_guard on public.tenant_commission_statements;
create trigger tenant_commission_statements_guard
  before update on public.tenant_commission_statements
  for each row execute function public.guard_commission_statement_records();
drop trigger if exists tenant_commission_statement_lines_guard on public.tenant_commission_statement_lines;
create trigger tenant_commission_statement_lines_guard
  before update on public.tenant_commission_statement_lines
  for each row execute function public.guard_commission_statement_records();
drop trigger if exists tenant_commission_statement_matches_guard on public.tenant_commission_statement_matches;
create trigger tenant_commission_statement_matches_guard
  before update on public.tenant_commission_statement_matches
  for each row execute function public.guard_commission_statement_records();

-- ── views ─────────────────────────────────────────────────────────────────────
-- What the ledger posts: accepted matches on statements that are not voided. A line with no date
-- posts on the last day of its statement's period.
create or replace view public.tenant_commission_statement_entries
with (security_invoker = true) as
select
  l.id as line_id,
  l.tenant_id,
  s.id as statement_id,
  s.carrier_id,
  s.period_start,
  s.period_end,
  s.original_filename,
  l.line_number,
  l.policy_number as statement_policy_number,
  l.insured_name as statement_insured_name,
  l.amount_cents,
  l.kind,
  l.line_date,
  coalesce(l.line_date, s.period_end) as posted_on,
  m.id as match_id,
  m.policy_id,
  m.method,
  m.accepted_by,
  m.accepted_at
from public.tenant_commission_statement_lines l
join public.tenant_commission_statements s on s.id = l.statement_id and s.tenant_id = l.tenant_id
join public.tenant_commission_statement_matches m on m.line_id = l.id and m.tenant_id = l.tenant_id and m.status = 'accepted'
where s.status <> 'voided';

create or replace view public.tenant_commission_statement_summaries
with (security_invoker = true) as
select
  s.id as statement_id,
  s.tenant_id,
  s.status,
  count(l.id)::integer as line_count,
  (count(l.id) filter (where l.review_status = 'accepted'))::integer as accepted_count,
  (count(l.id) filter (where l.review_status = 'proposed'))::integer as proposed_count,
  (count(l.id) filter (where l.review_status = 'unmatched'))::integer as unmatched_count,
  (count(l.id) filter (where l.review_status = 'left_unmatched'))::integer as left_unmatched_count,
  (count(l.id) filter (where l.review_status = 'error'))::integer as error_count,
  coalesce(sum(l.amount_cents) filter (where l.review_status = 'accepted'), 0)::bigint as accepted_cents,
  coalesce(sum(l.amount_cents) filter (where l.review_status <> 'error'), 0)::bigint as statement_cents
from public.tenant_commission_statements s
left join public.tenant_commission_statement_lines l on l.statement_id = s.id and l.tenant_id = s.tenant_id
group by s.id, s.tenant_id, s.status;

-- ── row level security and grants ─────────────────────────────────────────────
alter table public.tenant_commission_statements enable row level security;
alter table public.tenant_commission_statement_lines enable row level security;
alter table public.tenant_commission_statement_matches enable row level security;
alter table public.tenant_statement_column_mappings enable row level security;

drop policy if exists tenant_commission_statements_tenant_read on public.tenant_commission_statements;
create policy tenant_commission_statements_tenant_read on public.tenant_commission_statements
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tenant_commission_statement_lines_tenant_read on public.tenant_commission_statement_lines;
create policy tenant_commission_statement_lines_tenant_read on public.tenant_commission_statement_lines
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tenant_commission_statement_matches_tenant_read on public.tenant_commission_statement_matches;
create policy tenant_commission_statement_matches_tenant_read on public.tenant_commission_statement_matches
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists tenant_statement_column_mappings_tenant_read on public.tenant_statement_column_mappings;
create policy tenant_statement_column_mappings_tenant_read on public.tenant_statement_column_mappings
  for select to tenant_app
  using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.tenant_commission_statements from public, anon, authenticated;
revoke all on public.tenant_commission_statement_lines from public, anon, authenticated;
revoke all on public.tenant_commission_statement_matches from public, anon, authenticated;
revoke all on public.tenant_statement_column_mappings from public, anon, authenticated;
revoke all on public.tenant_commission_statement_entries from public, anon, authenticated;
revoke all on public.tenant_commission_statement_summaries from public, anon, authenticated;

-- No DELETE, for anybody.
revoke delete, truncate on public.tenant_commission_statements from service_role, tenant_app;
revoke delete, truncate on public.tenant_commission_statement_lines from service_role, tenant_app;
revoke delete, truncate on public.tenant_commission_statement_matches from service_role, tenant_app;
grant select, insert, update on public.tenant_commission_statements to service_role;
grant select, insert, update on public.tenant_commission_statement_lines to service_role;
grant select, insert, update on public.tenant_commission_statement_matches to service_role;
grant select, insert, update on public.tenant_statement_column_mappings to service_role;
grant select on public.tenant_commission_statement_entries to service_role;
grant select on public.tenant_commission_statement_summaries to service_role;

grant select on public.tenant_commission_statements to tenant_app;
grant select on public.tenant_commission_statement_lines to tenant_app;
grant select on public.tenant_commission_statement_matches to tenant_app;
grant select on public.tenant_statement_column_mappings to tenant_app;
grant select on public.tenant_commission_statement_entries to tenant_app;
grant select on public.tenant_commission_statement_summaries to tenant_app;

-- ── asserted against whatever this database holds ─────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['tenant_commission_statements', 'tenant_commission_statement_lines', 'tenant_commission_statement_matches', 'tenant_statement_column_mappings'] loop
    if to_regclass('public.' || t) is null then
      raise exception '% is missing', t;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception '% has row level security switched off', t;
    end if;
    if has_table_privilege('tenant_app', 'public.' || t, 'insert')
       or has_table_privilege('tenant_app', 'public.' || t, 'update')
       or has_table_privilege('tenant_app', 'public.' || t, 'delete') then
      raise exception 'the tenant plane can write %', t;
    end if;
    if not has_table_privilege('tenant_app', 'public.' || t, 'select') then
      raise exception 'the tenant plane cannot read %', t;
    end if;
  end loop;
  foreach t in array array['tenant_commission_statements', 'tenant_commission_statement_lines', 'tenant_commission_statement_matches'] loop
    if has_table_privilege('service_role', 'public.' || t, 'delete') then
      raise exception '% can be deleted from; statements are voided, never deleted', t;
    end if;
  end loop;
end $$;
