-- Prevent direct use of the legacy security-definer merge functions.
-- LA-0 uses the tenant-scoped signatures below; the legacy overloads predate
-- tenant isolation and must not remain callable by client-facing roles.
revoke all on function public.merge_contacts(uuid, uuid, jsonb)
  from public, anon, authenticated;

revoke all on function public.undo_contact_merge(uuid)
  from public, anon, authenticated;

grant execute on function public.merge_contacts(uuid, uuid, jsonb)
  to service_role;

grant execute on function public.undo_contact_merge(uuid)
  to service_role;
