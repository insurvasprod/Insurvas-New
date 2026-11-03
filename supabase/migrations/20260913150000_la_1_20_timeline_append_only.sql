-- LA-1.20: make the parts of the timeline that claim to be immutable actually be immutable.
--
-- The workspace payload types every timeline event as `immutable: true`, and it is a hardcoded
-- literal in lib/leadWorkspace/service.ts -- every event carries it regardless of what backs it. The
-- suite asserted `event.immutable === true`, which is a tautology: it was checking a constant.
--
-- The timeline is assembled from four sources. Their actual grants to service_role, which is the
-- role the application reads and writes with, were:
--
--   audit_log                   INSERT, SELECT                       already append-only
--   verification_field_changes  ... SELECT, UPDATE, DELETE, TRUNCATE freely rewritable
--   callback_history            ... SELECT, UPDATE, DELETE, TRUNCATE freely rewritable
--   partner_messages            ... SELECT, UPDATE, DELETE, TRUNCATE rewritable, and rewritten
--
-- So one of the four was what the payload claimed. Someone restricted audit_log deliberately and the
-- other three were never brought in line.
--
-- This migration revokes UPDATE and TRUNCATE on the two that no code path writes after insert.
-- Neither is updated anywhere in lib/, app/ or any migration -- both are append-only logs by intent
-- and now by permission. An entry in either can no longer be silently rewritten in place, which is
-- the failure that matters for a timeline: altering history leaves no trace, whereas adding to it
-- does.
--
-- DELETE is deliberately left in place, following 20260912300000_provider_calls_append_only.sql.
-- Every verification suite tears its fixtures down through service_role, so revoking DELETE would
-- break the harness across the module to buy a guarantee that a tenant-scoped API already withholds.
-- That is the same trade provider_calls made, and it is worth naming rather than leaving implicit.
--
-- partner_messages is NOT included, because the application genuinely updates it:
-- lib/leadNotes/service.ts edits a shared note in place. That is correct behaviour for a note and
-- wrong behaviour for a timeline entry, and it cannot be fixed with a grant -- see the backlog item.

revoke update, truncate on public.verification_field_changes from service_role;
revoke update, truncate on public.callback_history from service_role;

do $$
declare
  offending text;
begin
  -- Assert the two are now insert/select/delete only for service_role...
  select string_agg(format('%s:%s', table_name, privilege_type), ', ' order by table_name, privilege_type)
    into offending
  from (values
    ('verification_field_changes'::text, 'UPDATE'::text),
    ('verification_field_changes'::text, 'TRUNCATE'::text),
    ('callback_history'::text, 'UPDATE'::text),
    ('callback_history'::text, 'TRUNCATE'::text)
  ) as expected(table_name, privilege_type)
  where has_table_privilege('service_role', format('public.%I', table_name), privilege_type);
  if offending is not null then
    raise exception 'timeline source still rewritable: %', offending;
  end if;

  -- ...and that audit_log, the one that was already right, was not disturbed.
  if not has_table_privilege('service_role', 'public.audit_log', 'INSERT') then
    raise exception 'audit_log lost its INSERT grant';
  end if;

  -- ...and that reads still work, since the whole timeline depends on them.
  if not has_table_privilege('service_role', 'public.verification_field_changes', 'SELECT') then
    raise exception 'verification_field_changes lost its SELECT grant';
  end if;
end;
$$;
