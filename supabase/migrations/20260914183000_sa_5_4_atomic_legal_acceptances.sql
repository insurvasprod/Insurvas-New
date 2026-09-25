-- SA-5.4 follow-up: record one user's required acceptances as one transaction.
--
-- The single-document RPC remains for compatibility with older callers. Signup and the
-- re-acceptance gate use this batch form so a partial Terms/Privacy write can never be committed.
-- Existing rows remain idempotent and append-only.

create or replace function public.record_legal_acceptances(
  p_user_id       uuid,
  p_document_ids  uuid[],
  p_ip            inet,
  p_user_agent    text,
  p_context       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_id uuid;
  v_document public.legal_documents;
begin
  if coalesce(cardinality(p_document_ids), 0) = 0 then
    return;
  end if;

  foreach v_document_id in array p_document_ids loop
    select * into v_document
      from public.legal_documents
     where id = v_document_id;

    if not found then
      raise exception 'no such legal document';
    end if;

    insert into public.legal_acceptances
      (user_id, document_id, doc_type, version, ip, user_agent, context)
    values
      (p_user_id, v_document.id, v_document.doc_type, v_document.version,
       p_ip, p_user_agent, coalesce(p_context, 'signup'))
    on conflict (user_id, document_id) do nothing;
  end loop;
end;
$$;

revoke execute on function public.record_legal_acceptances(uuid, uuid[], inet, text, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.record_legal_acceptances(uuid, uuid[], inet, text, text)
  to service_role;

comment on function public.record_legal_acceptances(uuid, uuid[], inet, text, text) is
  'SA-5.4 atomic append-only batch acceptance. Any invalid document rolls back the whole batch.';
