-- ============================================================================
-- Pending migrations — 2 files, each in its own transaction
-- Generated 2026-09-24 by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.
--
-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.
-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is
-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,
-- regenerate, and run the whole script again — re-running is safe: the files use
-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.
--
-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs
--
-- Files, in order:
--    1. 20260924363000_legal_document_drafts.sql
--    2. 20260924364000_admin_totp_replay_guard.sql
-- ============================================================================

-- ─── [1/2] 20260924363000_legal_document_drafts.sql ──────────────────────────────
begin;

-- Legal document drafts (admin Legal page, board p-adm-legal).
--
-- Every row in legal_documents is live the moment it is inserted: current_legal_documents, the
-- public /legal/[type] page, /api/public/legal, signup and the /app/accept-terms gate all read the
-- highest version. So an unpublished draft cannot be a row there, and it cannot be edited in place
-- either (UPDATE is revoked from service_role, 20260830104547). It lives in its own table.
--
--   legal_document_drafts                   one unpublished draft per document type, editable
--   admin_legal_version_acceptance_counts   acceptances per version ("Effective … · N acceptances")
--   publish_legal_draft(...)                turns the saved draft into the next version, atomically
--
-- Drafts are never read by a customer surface. Nothing that serves customers is changed here, the
-- table is revoked from every customer-facing role, and the assertions at the bottom fail the
-- migration if the customer read paths (current_legal_documents, outstanding_legal_documents,
-- record_legal_acceptance[s]) ever reference it.
--
-- publish_legal_document is NOT redefined. publish_legal_draft calls it, so the version allocation,
-- the advisory lock and the minimum-length check stay in one place (latest definition:
-- 20260830111500_sa_5_4_publish_lock_fix).
--
-- Drafts are not evidence — nobody has agreed to one — so a draft row is deleted when it is
-- published or discarded. The published text is what legal_documents keeps forever.

-- 1. Drafts ----------------------------------------------------------------------------------------

create table if not exists public.legal_document_drafts (
  doc_type               public.legal_doc_type primary key,
  title                  text not null,
  content                text not null default '',
  change_summary         text,
  effective_date         date not null default current_date,
  requires_reacceptance  boolean not null default true,
  updated_by             uuid references public.admin_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint legal_document_drafts_title_length check (char_length(btrim(title)) between 3 and 160),
  constraint legal_document_drafts_summary_length check (change_summary is null or char_length(change_summary) <= 2000)
);

comment on table public.legal_document_drafts is
  'Unpublished legal text, one draft per document type. Staff console only: no customer surface reads it. Deleted when published (the published row in legal_documents is the record) or discarded.';

alter table public.legal_document_drafts enable row level security;

revoke all on public.legal_document_drafts from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.legal_document_drafts to service_role;

-- 2. Acceptances per version -----------------------------------------------------------------------

create or replace view public.admin_legal_version_acceptance_counts
with (security_invoker = true) as
select
  d.id                 as document_id,
  d.doc_type,
  d.version,
  count(a.id)::bigint  as accepted_count
from public.legal_documents d
left join public.legal_acceptances a on a.document_id = d.id
group by d.id, d.doc_type, d.version;

comment on view public.admin_legal_version_acceptance_counts is
  'Admin Legal page: how many acceptance records each version has. Staff console only.';

revoke all on public.admin_legal_version_acceptance_counts from public, anon, authenticated, tenant_app;
grant select on public.admin_legal_version_acceptance_counts to service_role;

-- 3. Publishing a draft ----------------------------------------------------------------------------

/**
 * Publishes the saved draft of p_doc_type as the next version and deletes the draft, in one
 * transaction.
 *
 * Two guards, both raised rather than silently resolved, because publishing binds every customer:
 *   p_expected_version     the version number the admin was shown ("Publish version 4"). If someone
 *                          published in between, the next number is no longer that one — refused.
 *   p_expected_updated_at  the draft as the admin last saw it. If another admin saved over it since,
 *                          the text that would be published is not the text on their screen — refused.
 *
 * The advisory lock is the one publish_legal_document takes (transaction-scoped, re-entrant in the
 * same session), taken first so the version read below cannot race a concurrent publish.
 */
create or replace function public.publish_legal_draft(
  p_doc_type             public.legal_doc_type,
  p_expected_version     integer,
  p_expected_updated_at  timestamptz,
  p_published_by         uuid
)
returns public.legal_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.legal_document_drafts;
  v_next  integer;
  v_row   public.legal_documents;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('legal_document:' || p_doc_type::text));

  select * into v_draft
    from public.legal_document_drafts
   where doc_type = p_doc_type
     for update;

  if not found then
    raise exception 'there is no saved draft of this document to publish'
      using errcode = 'P0002';
  end if;

  if p_expected_updated_at is null or v_draft.updated_at <> p_expected_updated_at then
    raise exception 'the draft was changed after you loaded it; reload to see the current draft before publishing'
      using errcode = '40001';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
    from public.legal_documents
   where doc_type = p_doc_type;

  if p_expected_version is null or v_next <> p_expected_version then
    raise exception 'version % was published by someone else while this page was open; reload before publishing',
      v_next - 1
      using errcode = '40001';
  end if;

  select * into v_row
    from public.publish_legal_document(
      p_doc_type,
      v_draft.title,
      v_draft.content,
      v_draft.effective_date,
      nullif(btrim(coalesce(v_draft.change_summary, '')), ''),
      v_draft.requires_reacceptance,
      p_published_by
    );

  delete from public.legal_document_drafts where doc_type = p_doc_type;

  return v_row;
end;
$$;

revoke execute on function public.publish_legal_draft(public.legal_doc_type, integer, timestamptz, uuid)
  from public, anon, authenticated, tenant_app;
grant execute on function public.publish_legal_draft(public.legal_doc_type, integer, timestamptz, uuid)
  to service_role;

comment on function public.publish_legal_draft(public.legal_doc_type, integer, timestamptz, uuid) is
  'Admin Legal page: publish the saved draft as the next version (via publish_legal_document) and delete the draft. Refuses a stale version number or a draft changed since it was loaded.';

-- 4. Assertions ------------------------------------------------------------------------------------

do $$
declare
  v_role text;
  v_def  text;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924363000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  if to_regclass('public.legal_document_drafts') is null then
    raise exception 'legal_document_drafts is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.legal_document_drafts'::regclass) then
    raise exception 'legal_document_drafts must have row level security enabled';
  end if;
  if to_regclass('public.admin_legal_version_acceptance_counts') is null then
    raise exception 'admin_legal_version_acceptance_counts is missing';
  end if;
  if to_regprocedure('public.publish_legal_draft(public.legal_doc_type,integer,timestamptz,uuid)') is null then
    raise exception 'publish_legal_draft is missing';
  end if;

  -- Customer-facing roles cannot see a draft, or the per-version counts, at all.
  foreach v_role in array array['anon', 'authenticated', 'tenant_app'] loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      if has_table_privilege(v_role, 'public.legal_document_drafts', 'SELECT')
         or has_table_privilege(v_role, 'public.legal_document_drafts', 'INSERT')
         or has_table_privilege(v_role, 'public.legal_document_drafts', 'UPDATE')
         or has_table_privilege(v_role, 'public.legal_document_drafts', 'DELETE') then
        raise exception '% has privileges on legal_document_drafts; drafts must never reach a customer', v_role;
      end if;
      if has_table_privilege(v_role, 'public.admin_legal_version_acceptance_counts', 'SELECT') then
        raise exception '% can read admin_legal_version_acceptance_counts', v_role;
      end if;
      if has_function_privilege(v_role, 'public.publish_legal_draft(public.legal_doc_type,integer,timestamptz,uuid)', 'EXECUTE') then
        raise exception '% can execute publish_legal_draft', v_role;
      end if;
    end if;
  end loop;

  -- What customers are shown and asked to accept is read from legal_documents only, never a draft.
  if pg_get_viewdef('public.current_legal_documents'::regclass) ~ 'legal_document_drafts' then
    raise exception 'current_legal_documents reads drafts; a draft would be shown to customers';
  end if;
  foreach v_def in array array[
    'public.outstanding_legal_documents(uuid)',
    'public.record_legal_acceptance(uuid,uuid,inet,text,text)',
    'public.record_legal_acceptances(uuid,uuid[],inet,text,text)'
  ] loop
    if to_regprocedure(v_def) is not null
       and pg_get_functiondef(to_regprocedure(v_def)) ~ 'legal_document_drafts' then
      raise exception '% reads drafts; a customer could be asked to accept unpublished text', v_def;
    end if;
  end loop;

  -- The one insert path is kept: publishing a draft goes through publish_legal_document.
  if pg_get_functiondef('public.publish_legal_draft(public.legal_doc_type,integer,timestamptz,uuid)'::regprocedure)
     !~ 'publish_legal_document' then
    raise exception 'publish_legal_draft must publish through publish_legal_document';
  end if;

  raise notice '20260924363000: legal drafts in place, invisible to customer roles and read paths';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924363000', 'legal_document_drafts') on conflict do nothing;
  end if;
end $bundle$;
commit;

-- ─── [2/2] 20260924364000_admin_totp_replay_guard.sql ────────────────────────────
begin;

-- ---------------------------------------------------------------------------
-- Admin second factor: refuse a replayed code (user decision, board p-adm-login)
--
-- A TOTP code is valid for its 30-second step plus one step of drift either side, and until now
-- nothing stopped the same code being accepted twice inside that window. admin_users.last_totp_step
-- records the time step (30s periods since the epoch) of the last code accepted for each admin.
-- POST /api/admin/auth/verify-2fa claims a new step with one conditional update:
--
--   update admin_users set last_totp_step = <step>
--    where id = <admin> and (last_totp_step is null or last_totp_step < <step>)
--   returning id
--
-- so a code from a step <= the last accepted one matches no row and is refused, and of two
-- concurrent verifies with the same code only one gets its row back (lib/adminAuth/totpReplay.ts).
--
-- Updating only this column fires none of the 20260924353000 super-admin guard triggers (they are
-- BEFORE UPDATE OF role, is_active). service_role already holds table-level UPDATE on admin_users,
-- which covers a new column; nothing else can read or write the table.
--
-- Until this is applied the app skips the replay check (42703 / PGRST204) and keeps the lockout.
-- Additive and idempotent: one nullable column. No data changes; null means "no code accepted yet".
-- ---------------------------------------------------------------------------

alter table public.admin_users
  add column if not exists last_totp_step bigint;

-- Guarded so scripts/check-migrations.mjs (which cannot run the ALTER above) does not report the
-- comment's missing column; on a real apply the column always exists by now.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'admin_users' and column_name = 'last_totp_step'
  ) then
    comment on column public.admin_users.last_totp_step is
      'Time step (unix seconds / 30) of the last second-factor code accepted for this admin. A code from this step or earlier is refused (replay protection). Null until the first sign-in after 20260924364000.';
  end if;
end;
$$;

-- PostgREST caches the schema; without this the new column is PGRST204 until the next reload.
notify pgrst, 'reload schema';

-- Assertions ----------------------------------------------------------------------------------------

do $$
declare
  v_type text;
  v_nullable text;
begin
  -- A role that cannot create objects cannot have applied anything above either (scripts/
  -- check-migrations.mjs parse-checks with such a role); a real apply always reaches the checks.
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise notice '20260924364000: assertions skipped, % cannot create in public', current_user;
    return;
  end if;

  select c.data_type, c.is_nullable
    into v_type, v_nullable
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'admin_users'
     and c.column_name = 'last_totp_step';

  if v_type is null then
    raise exception '20260924364000: admin_users.last_totp_step is missing';
  end if;
  if v_type <> 'bigint' then
    raise exception '20260924364000: admin_users.last_totp_step is %, expected bigint', v_type;
  end if;
  if v_nullable <> 'YES' then
    raise exception '20260924364000: admin_users.last_totp_step must be nullable (null = no code accepted yet)';
  end if;

  if not has_column_privilege('service_role', 'public.admin_users', 'last_totp_step', 'UPDATE') then
    raise exception '20260924364000: service_role cannot update admin_users.last_totp_step, so verify-2fa cannot claim a step';
  end if;
  -- Not this file's to fix (20260910133000 revokes these), so a warning rather than a failed apply.
  if has_table_privilege('anon', 'public.admin_users', 'SELECT')
     or has_table_privilege('authenticated', 'public.admin_users', 'SELECT') then
    raise warning '20260924364000: admin_users is readable by anon or authenticated; 20260910133000 should have revoked that';
  end if;

  raise notice '20260924364000: admin_users.last_totp_step in place; a second-factor code is accepted once';
end;
$$;

do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260924364000', 'admin_totp_replay_guard') on conflict do nothing;
  end if;
end $bundle$;
commit;
