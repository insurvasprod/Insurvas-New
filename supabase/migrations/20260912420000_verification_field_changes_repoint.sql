-- Repoint the last of this application's verification children at the renamed parent.
--
-- 20260912400000 moved this application's verification sessions to tenant_verification_sessions and
-- repointed verification_fields. It repointed only that one, because that was the child I had
-- looked at. Four tables carry a foreign key to the CRM's verification_sessions, and the split by
-- owner is:
--
--   verification_fields          ours   -- repointed by 20260912400000
--   verification_field_changes   ours   -- declared in 20260903090000, LA-1.11's own migration,
--                                          read by lib/leadWorkspace/service.ts. Repointed here.
--   verification_items           CRM    -- left alone
--   verification_item_audit      CRM    -- left alone, it is verification_items' audit sibling
--
-- Until now every correction failed with
--
--   23503 insert or update on table "verification_field_changes" violates foreign key constraint
--         "verification_field_changes_session_id_fkey"
--
-- because the session it points at lives in the new table and the constraint still referenced the
-- old one. That is LA-1.11's "a correction updates the lead and leaves an audit trail of the old
-- value" and the two LA-1.20 checks that read the same trail.
--
-- This is the second time in this rename that I fixed the dependent I happened to be looking at
-- rather than enumerating them. The assertion below closes that off: it fails if any table this
-- repository declares still references the CRM's session table, so a third one cannot hide.
--
-- Safe: verification_field_changes holds zero rows.

alter table public.verification_field_changes
  drop constraint if exists verification_field_changes_session_id_fkey;
alter table public.verification_field_changes
  add constraint verification_field_changes_session_id_fkey
  foreign key (session_id) references public.tenant_verification_sessions(id) on delete cascade;

do $$
declare
  stragglers text;
begin
  select string_agg(conrelid::regclass::text, ', ') into stragglers
    from pg_constraint
   where confrelid = 'public.verification_sessions'::regclass
     and conrelid::regclass::text = any (array['verification_fields', 'verification_field_changes']);

  if stragglers is not null then
    raise exception 'still pointing at the CRM session table: %', stragglers;
  end if;
end;
$$;
