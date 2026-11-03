-- LA-4.1 · LA-4.2 · LA-4.3: Book of Business › Statements
--
--   4.1  The original statement file is kept forever, in a private bucket, beside the lines read
--        from it, so a statement can be downloaded and re-read when the parser improves. CSV and
--        Excel (.xlsx) are parsed. PDF is stored and not parsed.
--   4.2  A PDF statement waits in `awaiting_entry` until a person types its lines in. No AI and no
--        provider call ever reads it.
--   4.3  Matching by insured name + carrier when no policy number matches. This is always a
--        PROPOSAL that a person accepts, never a posting. The unmatched queue can be re-matched
--        against the current book. A statement can be re-processed from its stored original: the
--        old one is voided and kept, and the new one points back to it.
--
-- Additive. The LA-0 import function `import_commission_statement` is left as it was. The
-- application falls back to it while this migration is not applied, so CSV import keeps working
-- exactly as before.
--
-- Requires 20260924260000 and 20260924260100.
--
-- Down (only before any statement uses the new columns):
--   drop function if exists public.rematch_commission_statement_lines(uuid, uuid, jsonb);
--   drop function if exists public.add_manual_statement_lines(uuid, uuid, uuid, jsonb);
--   drop function if exists public.import_commission_statement_v2(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb, text, text, bigint, text, text, uuid);
--   then the 20260924260000 guard function, constraints and columns as they were.

-- ── storage ─────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'commission-statements',
  'commission-statements',
  false,
  10485760,
  array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf']::text[]
)
on conflict (id) do nothing;

-- ── statements: the stored original, and where a re-processed one came from ─
alter table public.tenant_commission_statements
  add column if not exists file_kind text not null default 'csv',
  add column if not exists storage_path text,
  add column if not exists file_bytes bigint,
  add column if not exists content_type text,
  add column if not exists sheet_name text,
  add column if not exists reprocessed_from uuid references public.tenant_commission_statements(id) on delete restrict;

alter table public.tenant_commission_statements drop constraint if exists tenant_commission_statements_file_kind;
alter table public.tenant_commission_statements add constraint tenant_commission_statements_file_kind
  check (file_kind in ('csv', 'xlsx', 'pdf'));
alter table public.tenant_commission_statements drop constraint if exists tenant_commission_statements_storage_path;
alter table public.tenant_commission_statements add constraint tenant_commission_statements_storage_path
  check (storage_path is null or char_length(storage_path) between 1 and 512);
alter table public.tenant_commission_statements drop constraint if exists tenant_commission_statements_file_bytes;
alter table public.tenant_commission_statements add constraint tenant_commission_statements_file_bytes
  check (file_bytes is null or file_bytes > 0);
alter table public.tenant_commission_statements drop constraint if exists tenant_commission_statements_sheet_name;
alter table public.tenant_commission_statements add constraint tenant_commission_statements_sheet_name
  check (sheet_name is null or char_length(sheet_name) <= 200);

-- A PDF waits for its lines; every other statement is read when it is imported.
alter table public.tenant_commission_statements drop constraint if exists tenant_commission_statements_status;
alter table public.tenant_commission_statements add constraint tenant_commission_statements_status
  check (status in ('awaiting_entry', 'review', 'reviewed', 'voided'));

create index if not exists tenant_commission_statements_reprocessed_from_idx
  on public.tenant_commission_statements (reprocessed_from);
create index if not exists tenant_commission_statements_storage_path_idx
  on public.tenant_commission_statements (tenant_id, storage_path);

-- ── lines: typed in by hand, and the premium / rate a carrier reports ────────
alter table public.tenant_commission_statement_lines
  add column if not exists entry_source text not null default 'file',
  add column if not exists premium_cents bigint,
  add column if not exists rate_bp integer;

alter table public.tenant_commission_statement_lines drop constraint if exists tenant_commission_statement_lines_entry_source;
alter table public.tenant_commission_statement_lines add constraint tenant_commission_statement_lines_entry_source
  check (entry_source in ('file', 'manual'));
alter table public.tenant_commission_statement_lines drop constraint if exists tenant_commission_statement_lines_premium;
alter table public.tenant_commission_statement_lines add constraint tenant_commission_statement_lines_premium
  check (premium_cents is null or premium_cents >= 0);
-- Basis points of premium: 110% is 11,000. A ceiling well above any real contract level.
alter table public.tenant_commission_statement_lines drop constraint if exists tenant_commission_statement_lines_rate;
alter table public.tenant_commission_statement_lines add constraint tenant_commission_statement_lines_rate
  check (rate_bp is null or rate_bp between 0 and 100000);

-- ── matches: a name match is a proposal, like an exact one ─────────────────
alter table public.tenant_commission_statement_matches drop constraint if exists tenant_commission_statement_matches_method;
alter table public.tenant_commission_statement_matches add constraint tenant_commission_statement_matches_method
  check (method in ('exact', 'name', 'manual'));
alter table public.tenant_commission_statement_matches drop constraint if exists tenant_commission_statement_matches_manual_is_decided;
alter table public.tenant_commission_statement_matches add constraint tenant_commission_statement_matches_manual_is_decided
  check (method in ('exact', 'name') or status <> 'proposed');

-- ── what a record may not become (20260924260000, extended) ────────────────
-- The same rules as before, plus: the stored original and where a statement came from are fixed at
-- insert, and a statement's row count changes only while its lines are being typed in.
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
       or new.headers <> old.headers or new.uploaded_at <> old.uploaded_at
       or new.file_kind <> old.file_kind
       or new.storage_path is distinct from old.storage_path
       or new.file_bytes is distinct from old.file_bytes
       or new.content_type is distinct from old.content_type
       or new.sheet_name is distinct from old.sheet_name
       or new.reprocessed_from is distinct from old.reprocessed_from then
      raise exception 'A commission statement''s source cannot be changed after import' using errcode = '55000';
    end if;
    if new.row_count <> old.row_count and old.status <> 'awaiting_entry' then
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
       or new.parse_error is distinct from old.parse_error
       or new.entry_source <> old.entry_source
       or new.premium_cents is distinct from old.premium_cents
       or new.rate_bp is distinct from old.rate_bp then
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

-- ── import, with the stored original (4.1), PDFs (4.2) and re-processing (4.3) ─
-- One transaction: void the statement being re-processed (when there is one), write the new
-- statement, every line and its proposals (exact or name), and remember the column mapping. A PDF
-- carries no lines and waits in `awaiting_entry`.
create or replace function public.import_commission_statement_v2(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_carrier_id uuid,
  p_period_start date,
  p_period_end date,
  p_original_filename text,
  p_file_sha256 text,
  p_headers jsonb,
  p_mapping jsonb,
  p_lines jsonb,
  p_file_kind text,
  p_storage_path text,
  p_file_bytes bigint,
  p_content_type text,
  p_sheet_name text,
  p_reprocessed_from uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_statement_id uuid;
  v_count integer;
  v_foreign integer;
  v_status text;
begin
  if p_file_kind is null or p_file_kind not in ('csv', 'xlsx', 'pdf') then
    raise exception 'A statement file is CSV, Excel or PDF' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The statement lines must be a list' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if p_file_kind = 'pdf' and v_count > 0 then
    raise exception 'A PDF statement''s lines are typed in after it is stored' using errcode = '22023';
  end if;
  if p_file_kind <> 'pdf' and v_count = 0 then
    raise exception 'The statement has no lines' using errcode = '22023';
  end if;
  if v_count > 10000 then
    raise exception 'A statement can hold at most 10,000 lines' using errcode = '22023';
  end if;
  if not exists (select 1 from public.carriers where id = p_carrier_id) then
    raise exception 'Choose a carrier from the carrier library' using errcode = '22023';
  end if;
  if p_storage_path is not null and p_storage_path not like (p_tenant_id::text || '/%') then
    raise exception 'A statement file is stored under its own workspace' using errcode = '22023';
  end if;

  select count(*) into v_foreign
    from jsonb_array_elements(p_lines) e
   where nullif(e->>'proposed_policy_id', '') is not null
     and not exists (
       select 1 from public.tenant_policies p
        where p.id = (e->>'proposed_policy_id')::uuid and p.tenant_id = p_tenant_id
     );
  if v_foreign > 0 then
    raise exception 'A proposed match names a policy outside this workspace' using errcode = '22023';
  end if;

  -- Re-processing: the statement it replaces is voided first, in this transaction, so the same file
  -- can be read again without tripping the duplicate index, and both stay on the record.
  if p_reprocessed_from is not null then
    update public.tenant_commission_statements
       set status = 'voided',
           void_reason = 'Re-processed from the stored original file',
           voided_by = p_actor_user_id,
           voided_at = now()
     where id = p_reprocessed_from and tenant_id = p_tenant_id and status <> 'voided';
    if not found then
      raise exception 'Only a statement in this workspace that is not voided can be re-processed' using errcode = 'P0002';
    end if;
  end if;

  v_status := case
    when p_file_kind = 'pdf' then 'awaiting_entry'
    when exists (select 1 from jsonb_array_elements(p_lines) e where nullif(e->>'parse_error', '') is null) then 'review'
    else 'reviewed'
  end;

  insert into public.tenant_commission_statements (
    tenant_id, carrier_id, period_start, period_end, original_filename, file_sha256,
    headers, column_mapping, row_count, status, uploaded_by,
    file_kind, storage_path, file_bytes, content_type, sheet_name, reprocessed_from
  )
  values (
    p_tenant_id, p_carrier_id, p_period_start, p_period_end, btrim(p_original_filename), lower(p_file_sha256),
    coalesce(p_headers, '[]'::jsonb), coalesce(p_mapping, '{}'::jsonb), v_count, v_status, p_actor_user_id,
    p_file_kind, p_storage_path, p_file_bytes, nullif(btrim(p_content_type), ''), nullif(btrim(p_sheet_name), ''), p_reprocessed_from
  )
  returning id into v_statement_id;

  if v_count > 0 then
    insert into public.tenant_commission_statement_lines (
      tenant_id, statement_id, line_number, raw, policy_number, insured_name, amount_cents, kind,
      line_date, parse_error, review_status, entry_source, premium_cents, rate_bp
    )
    select
      p_tenant_id,
      v_statement_id,
      (e->>'line_number')::integer,
      coalesce(e->'raw', '{}'::jsonb),
      nullif(btrim(e->>'policy_number'), ''),
      nullif(btrim(e->>'insured_name'), ''),
      (e->>'amount_cents')::bigint,
      nullif(e->>'kind', ''),
      nullif(e->>'line_date', '')::date,
      nullif(e->>'parse_error', ''),
      case
        when nullif(e->>'parse_error', '') is not null then 'error'
        when nullif(e->>'proposed_policy_id', '') is not null then 'proposed'
        else 'unmatched'
      end,
      'file',
      nullif(e->>'premium_cents', '')::bigint,
      nullif(e->>'rate_bp', '')::integer
    from jsonb_array_elements(p_lines) e;

    insert into public.tenant_commission_statement_matches (tenant_id, line_id, policy_id, method, status)
    select p_tenant_id, l.id, (e->>'proposed_policy_id')::uuid,
           case when e->>'proposed_method' = 'name' then 'name' else 'exact' end,
           'proposed'
      from jsonb_array_elements(p_lines) e
      join public.tenant_commission_statement_lines l
        on l.statement_id = v_statement_id and l.line_number = (e->>'line_number')::integer
     where nullif(e->>'proposed_policy_id', '') is not null
       and nullif(e->>'parse_error', '') is null;
  end if;

  -- A PDF has no columns, so it leaves the carrier's remembered mapping alone.
  if p_file_kind <> 'pdf' then
    insert into public.tenant_statement_column_mappings (tenant_id, carrier_id, mapping, updated_by, updated_at)
    values (p_tenant_id, p_carrier_id, coalesce(p_mapping, '{}'::jsonb), p_actor_user_id, now())
    on conflict (tenant_id, carrier_id)
    do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = now();
  end if;

  return v_statement_id;
end;
$$;

-- ── lines typed in from a PDF (4.2) ─────────────────────────────────────────
-- Only while the statement is `awaiting_entry`, and only once: the lines arrive together, the
-- application has already validated and matched them, and the statement moves on to review.
create or replace function public.add_manual_statement_lines(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_statement_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_statement public.tenant_commission_statements%rowtype;
  v_count integer;
  v_foreign integer;
  v_status text;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter at least one line' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count > 10000 then
    raise exception 'A statement can hold at most 10,000 lines' using errcode = '22023';
  end if;

  select * into v_statement
    from public.tenant_commission_statements
   where id = p_statement_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'That statement is not in this workspace' using errcode = 'P0002';
  end if;
  if v_statement.status <> 'awaiting_entry' then
    raise exception 'This statement is not waiting for its lines to be entered' using errcode = '55000';
  end if;

  select count(*) into v_foreign
    from jsonb_array_elements(p_lines) e
   where nullif(e->>'proposed_policy_id', '') is not null
     and not exists (
       select 1 from public.tenant_policies p
        where p.id = (e->>'proposed_policy_id')::uuid and p.tenant_id = p_tenant_id
     );
  if v_foreign > 0 then
    raise exception 'A proposed match names a policy outside this workspace' using errcode = '22023';
  end if;

  insert into public.tenant_commission_statement_lines (
    tenant_id, statement_id, line_number, raw, policy_number, insured_name, amount_cents, kind,
    line_date, parse_error, review_status, entry_source, premium_cents, rate_bp
  )
  select
    p_tenant_id,
    p_statement_id,
    (e->>'line_number')::integer,
    coalesce(e->'raw', '{}'::jsonb),
    nullif(btrim(e->>'policy_number'), ''),
    nullif(btrim(e->>'insured_name'), ''),
    (e->>'amount_cents')::bigint,
    nullif(e->>'kind', ''),
    nullif(e->>'line_date', '')::date,
    nullif(e->>'parse_error', ''),
    case
      when nullif(e->>'parse_error', '') is not null then 'error'
      when nullif(e->>'proposed_policy_id', '') is not null then 'proposed'
      else 'unmatched'
    end,
    'manual',
    nullif(e->>'premium_cents', '')::bigint,
    nullif(e->>'rate_bp', '')::integer
  from jsonb_array_elements(p_lines) e;

  insert into public.tenant_commission_statement_matches (tenant_id, line_id, policy_id, method, status, proposed_by)
  select p_tenant_id, l.id, (e->>'proposed_policy_id')::uuid,
         case when e->>'proposed_method' = 'name' then 'name' else 'exact' end,
         'proposed', p_actor_user_id
    from jsonb_array_elements(p_lines) e
    join public.tenant_commission_statement_lines l
      on l.statement_id = p_statement_id and l.line_number = (e->>'line_number')::integer
   where nullif(e->>'proposed_policy_id', '') is not null
     and nullif(e->>'parse_error', '') is null;

  v_status := case
    when exists (select 1 from public.tenant_commission_statement_lines where statement_id = p_statement_id and review_status <> 'error') then 'review'
    else 'reviewed'
  end;
  update public.tenant_commission_statements set row_count = v_count, status = v_status where id = p_statement_id;

  return jsonb_build_object(
    'lines', v_count,
    'proposed', (select count(*) from public.tenant_commission_statement_lines where statement_id = p_statement_id and review_status = 'proposed'),
    'errors', (select count(*) from public.tenant_commission_statement_lines where statement_id = p_statement_id and review_status = 'error'),
    'status', v_status
  );
end;
$$;

-- ── re-matching the unmatched queue against the current book (4.3) ───────────
-- The application computes the proposals; this writes them. Only a line that is `unmatched`, on a
-- statement that is not voided, takes one. A line a person set aside on purpose (`left_unmatched`)
-- is left where they put it.
create or replace function public.rematch_commission_statement_lines(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_proposals jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_proposal jsonb;
  v_line public.tenant_commission_statement_lines%rowtype;
  v_policy uuid;
  v_written integer := 0;
  v_statements uuid[] := '{}';
  v_log jsonb := '[]'::jsonb;
begin
  if p_proposals is null or jsonb_typeof(p_proposals) <> 'array' then
    raise exception 'The proposals must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_proposals) > 10000 then
    raise exception 'Too many lines in one re-match' using errcode = '22023';
  end if;

  for v_proposal in select value from jsonb_array_elements(p_proposals) loop
    select l.* into v_line
      from public.tenant_commission_statement_lines l
      join public.tenant_commission_statements s on s.id = l.statement_id and s.tenant_id = l.tenant_id
     where l.id = nullif(v_proposal->>'line_id', '')::uuid
       and l.tenant_id = p_tenant_id
       and l.review_status = 'unmatched'
       and s.status <> 'voided'
     for update of l;
    -- A line someone decided in the meantime is skipped, not an error.
    if not found then
      continue;
    end if;
    v_policy := nullif(v_proposal->>'policy_id', '')::uuid;
    if v_policy is null or not exists (select 1 from public.tenant_policies where id = v_policy and tenant_id = p_tenant_id) then
      raise exception 'A proposed match names a policy outside this workspace' using errcode = '22023';
    end if;

    insert into public.tenant_commission_statement_matches (tenant_id, line_id, policy_id, method, status, proposed_by)
    values (p_tenant_id, v_line.id, v_policy, case when v_proposal->>'method' = 'name' then 'name' else 'exact' end, 'proposed', p_actor_user_id);
    update public.tenant_commission_statement_lines set review_status = 'proposed' where id = v_line.id;

    v_written := v_written + 1;
    if not v_line.statement_id = any (v_statements) then
      v_statements := v_statements || v_line.statement_id;
    end if;
    v_log := v_log || jsonb_build_array(jsonb_build_object('line_id', v_line.id, 'statement_id', v_line.statement_id, 'line_number', v_line.line_number, 'policy_id', v_policy, 'method', coalesce(v_proposal->>'method', 'exact')));
  end loop;

  update public.tenant_commission_statements
     set status = 'review'
   where tenant_id = p_tenant_id and id = any (v_statements) and status = 'reviewed';

  return jsonb_build_object('proposed', v_written, 'statements', coalesce(array_length(v_statements, 1), 0), 'lines', v_log);
end;
$$;

revoke all on function public.import_commission_statement_v2(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb, text, text, bigint, text, text, uuid) from public, anon, authenticated;
revoke all on function public.add_manual_statement_lines(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.rematch_commission_statement_lines(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_commission_statement_v2(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb, text, text, bigint, text, text, uuid) to service_role;
grant execute on function public.add_manual_statement_lines(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.rematch_commission_statement_lines(uuid, uuid, jsonb) to service_role;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'commission-statements' and public = false) then
    raise exception '20261002100000: the commission-statements bucket is missing or public';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_commission_statements' and column_name = 'storage_path') then
    raise exception '20261002100000: tenant_commission_statements.storage_path is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_commission_statement_lines' and column_name = 'entry_source') then
    raise exception '20261002100000: tenant_commission_statement_lines.entry_source is missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'import_commission_statement_v2') then
    raise exception '20261002100000: import_commission_statement_v2 is missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'add_manual_statement_lines') then
    raise exception '20261002100000: add_manual_statement_lines is missing';
  end if;
  if not exists (select 1 from pg_proc where proname = 'rematch_commission_statement_lines') then
    raise exception '20261002100000: rematch_commission_statement_lines is missing';
  end if;
  if has_table_privilege('service_role', 'public.tenant_commission_statements', 'DELETE') then
    raise exception '20261002100000: statements can be deleted';
  end if;
end $$;
