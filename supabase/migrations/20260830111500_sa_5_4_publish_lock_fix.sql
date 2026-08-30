-- `select max(...) ... for update` is illegal in Postgres — "FOR UPDATE is not allowed with
-- aggregate functions" — so the concurrency guard in publish_legal_document never worked. Found by
-- verify:legal on the first real publish.
--
-- An advisory lock keyed on the document type does what the row lock was meant to: two admins
-- publishing the same document at the same moment serialise, and a publish of the Terms does not
-- block a publish of the Privacy Policy. It is a transaction-scoped lock, so it is released on
-- commit or rollback with nothing to clean up.
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

  perform pg_advisory_xact_lock(hashtext('legal_document:' || p_doc_type::text));

  select coalesce(max(version), 0) + 1 into v_next
    from public.legal_documents
   where doc_type = p_doc_type;

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
