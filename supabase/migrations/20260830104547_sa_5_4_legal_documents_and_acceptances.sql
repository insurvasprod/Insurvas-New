-- SA-5.4 · Terms & privacy acceptance tracking.

create type public.legal_doc_type as enum ('tos', 'privacy', 'dpa');

/**
 * One row per published version of a legal document. The text is stored here, at that version,
 * because "the text of v1 is still retrievable after v2 is published" is the whole point — a
 * pointer to a file that later changes proves nothing about what someone agreed to.
 */
create table public.legal_documents (
  id                     uuid primary key default gen_random_uuid(),
  doc_type               public.legal_doc_type not null,
  version                integer not null,
  effective_date         date not null,
  title                  text not null,
  content                text not null,
  -- What changed since the previous version, shown on the re-acceptance screen. The ticket
  -- requires that users "can read what changed", and a diff of legal prose is unreadable.
  change_summary         text,
  -- A typo fix should not interrupt every customer. A material change should.
  requires_reacceptance  boolean not null default true,
  is_draft               boolean not null default false,
  published_by           uuid references public.admin_users(id),
  published_at           timestamptz not null default now(),

  unique (doc_type, version),
  constraint legal_documents_version_positive check (version >= 1)
);

comment on table public.legal_documents is
  'Versioned legal text. Rows are never updated or deleted — the text as it stood IS the evidence.';
comment on column public.legal_documents.is_draft is
  'Seeded placeholder text not reviewed by counsel. Surfaced to the reader, not hidden.';

create index legal_documents_current_idx on public.legal_documents (doc_type, version desc);

/**
 * One row per acceptance. Append-only, enforced by privilege rather than by convention — the same
 * approach as invoices and payments. An admin who can UPDATE this table can rewrite what a customer
 * agreed to, which is exactly the thing this table exists to make impossible.
 */
create table public.legal_acceptances (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  document_id   uuid not null references public.legal_documents(id),
  doc_type      public.legal_doc_type not null,
  version       integer not null,
  accepted_at   timestamptz not null default now(),
  ip            inet,
  user_agent    text,
  -- Where the acceptance happened: the signup form, or the re-acceptance gate.
  context       text not null default 'signup',

  -- Accepting the same version twice is a no-op, not a second agreement.
  unique (user_id, document_id)
);

comment on table public.legal_acceptances is
  'Append-only. UPDATE and DELETE are revoked from every role including service_role.';

create index legal_acceptances_user_idx on public.legal_acceptances (user_id, accepted_at desc);
create index legal_acceptances_document_idx on public.legal_acceptances (document_id);

alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;

revoke all on public.legal_documents from tenant_app, anon, authenticated;
revoke all on public.legal_acceptances from tenant_app, anon, authenticated;

-- Immutability is a privilege, not a convention. service_role may INSERT and SELECT; nothing may
-- UPDATE or DELETE. A correction is a new version, which is what leaves a trail.
revoke update, delete, truncate on public.legal_acceptances from public, service_role;
grant select, insert on public.legal_acceptances to service_role;

-- Legal documents are equally immutable once published, with ONE exception handled by a function
-- below: clearing requires_reacceptance, so a mistaken publish cannot lock out every customer.
revoke update, delete, truncate on public.legal_documents from public, service_role;
grant select, insert on public.legal_documents to service_role;

/**
 * Publishes the next version of a document.
 *
 * The version number is allocated here, inside the transaction, rather than by the caller reading
 * max(version) and adding one — two admins publishing at the same moment would otherwise both
 * compute the same number and one would lose.
 */
create or replace function public.publish_legal_document(
  p_doc_type              public.legal_doc_type,
  p_title                 text,
  p_content               text,
  p_effective_date        date,
  p_change_summary        text,
  p_requires_reacceptance boolean,
  p_published_by          uuid
)
returns public.legal_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_row  public.legal_documents;
begin
  if length(coalesce(trim(p_content), '')) < 50 then
    raise exception 'the document text is too short to be a real legal document';
  end if;

  -- Locks the doc_type's existing rows so a concurrent publish waits rather than racing.
  select coalesce(max(version), 0) + 1 into v_next
    from public.legal_documents
   where doc_type = p_doc_type
     for update;

  insert into public.legal_documents
    (doc_type, version, effective_date, title, content, change_summary,
     requires_reacceptance, is_draft, published_by)
  values
    (p_doc_type, v_next, p_effective_date, p_title, p_content, p_change_summary,
     coalesce(p_requires_reacceptance, true), false, p_published_by)
  returning * into v_row;

  return v_row;
end;
$$;

/**
 * Clears the re-acceptance requirement on a published version.
 *
 * The escape hatch for a mistaken publish. Without it, publishing a version marked material locks
 * every paying customer out of the product with no recovery short of editing the database by hand.
 * This is the ONLY permitted mutation of a published document, and it can only ever REMOVE an
 * interruption — it cannot introduce one, cannot alter the text, and cannot delete the row.
 */
create or replace function public.clear_reacceptance_requirement(p_document_id uuid)
returns public.legal_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.legal_documents;
begin
  update public.legal_documents
     set requires_reacceptance = false
   where id = p_document_id
  returning * into v_row;

  if not found then raise exception 'no such legal document'; end if;
  return v_row;
end;
$$;

revoke execute on function public.publish_legal_document(public.legal_doc_type, text, text, date, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_legal_document(public.legal_doc_type, text, text, date, text, boolean, uuid)
  to service_role;

revoke execute on function public.clear_reacceptance_requirement(uuid) from public, anon, authenticated;
grant execute on function public.clear_reacceptance_requirement(uuid) to service_role;

/**
 * Records an acceptance. Idempotent: accepting the same version twice keeps the FIRST timestamp,
 * because the moment they agreed is the fact worth having, not the moment they clicked again.
 */
create or replace function public.record_legal_acceptance(
  p_user_id     uuid,
  p_document_id uuid,
  p_ip          inet,
  p_user_agent  text,
  p_context     text
)
returns public.legal_acceptances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.legal_documents;
  v_row public.legal_acceptances;
begin
  select * into v_doc from public.legal_documents where id = p_document_id;
  if not found then raise exception 'no such legal document'; end if;

  insert into public.legal_acceptances
    (user_id, document_id, doc_type, version, ip, user_agent, context)
  values
    (p_user_id, p_document_id, v_doc.doc_type, v_doc.version, p_ip, p_user_agent,
     coalesce(p_context, 'signup'))
  on conflict (user_id, document_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.legal_acceptances
     where user_id = p_user_id and document_id = p_document_id;
  end if;

  return v_row;
end;
$$;

revoke execute on function public.record_legal_acceptance(uuid, uuid, inet, text, text) from public, anon, authenticated;
grant execute on function public.record_legal_acceptance(uuid, uuid, inet, text, text) to service_role;

/** The current version of each document — what a new signup must accept. */
create or replace view public.current_legal_documents as
select distinct on (doc_type)
  id, doc_type, version, effective_date, title, change_summary,
  requires_reacceptance, is_draft, published_at
from public.legal_documents
order by doc_type, version desc;

/**
 * What a given user still owes.
 *
 * A user owes a document when the current version requires re-acceptance and they have not
 * accepted THAT version. Accepting v1 does not discharge v2 — which is the entire ticket.
 */
create or replace function public.outstanding_legal_documents(p_user_id uuid)
returns setof public.current_legal_documents
language sql
stable
as $$
  select c.*
    from public.current_legal_documents c
   where c.requires_reacceptance
     and not exists (
       select 1 from public.legal_acceptances a
        where a.user_id = p_user_id and a.document_id = c.id
     );
$$;

revoke execute on function public.outstanding_legal_documents(uuid) from public, anon, authenticated;
grant execute on function public.outstanding_legal_documents(uuid) to service_role;

/** Acceptance rate per current document, for the admin screen. */
create or replace view public.admin_legal_acceptance_stats as
select
  c.id            as document_id,
  c.doc_type,
  c.version,
  c.title,
  c.is_draft,
  c.requires_reacceptance,
  c.published_at,
  (select count(*) from public.users u where u.status <> 'inactive')            as eligible_users,
  (select count(*) from public.legal_acceptances a where a.document_id = c.id)  as accepted_count
from public.current_legal_documents c;

revoke all on public.current_legal_documents from tenant_app, anon, authenticated;
revoke all on public.admin_legal_acceptance_stats from tenant_app, anon, authenticated;
