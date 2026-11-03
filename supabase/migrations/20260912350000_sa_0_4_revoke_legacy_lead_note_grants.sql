-- SA-0.4: remove stale client grants from the legacy/current hybrid lead-note tables.
--
-- The application routes access these tables through the server-only Supabase client and
-- perform tenant scoping in lib/leadNotes/service.ts. The live database still contains the
-- older authenticated policies on lead_notes (organization_id/created_by) alongside the
-- current tenant_id/author_user_id columns. Until that contract is intentionally migrated,
-- direct client access must be closed rather than relying on the incompatible policies.
-- This is additive and reversible: no rows, policies, or columns are changed.

revoke all on table public.lead_notes,
  public.lead_note_edits,
  public.lead_note_mentions,
  public.agent_notifications
from public, anon, authenticated, tenant_app;

grant select, insert, update on table public.lead_notes to service_role;
grant select, insert, update on table public.lead_note_edits to service_role;
grant select, insert, update on table public.lead_note_mentions to service_role;
grant select, insert, update on table public.agent_notifications to service_role;

-- The current application does not call platform_audit_events directly; audit_log is the
-- application-facing audit store. Retain the table and its append-only trigger, but remove
-- stale Data API DML grants so platform audit history is server-only as well.
revoke all on table public.platform_audit_events
from public, anon, authenticated, tenant_app;

grant select, insert on table public.platform_audit_events to service_role;

-- These SECURITY DEFINER routines are only called by server-side services/triggers in the
-- current checkout. Leaving the default PUBLIC EXECUTE grant would expose privileged RPC
-- entry points through the Data API. Keep service-role execution for the intended callers.
revoke execute on function public.claim_unclaimed_sla_events(integer) from public, anon, authenticated;
grant execute on function public.claim_unclaimed_sla_events(integer) to service_role;
revoke execute on function public.initialize_verification_items(uuid, text) from public, anon, authenticated;
grant execute on function public.initialize_verification_items(uuid, text) to service_role;
revoke execute on function public.is_tenant_phone_suppressed(uuid, text) from public, anon, authenticated;
grant execute on function public.is_tenant_phone_suppressed(uuid, text) to service_role;
revoke execute on function public.outbound_enforce_agent_campaign() from public, anon, authenticated;
grant execute on function public.outbound_enforce_agent_campaign() to service_role;
revoke execute on function public.seed_default_dispositions(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_dispositions(uuid) to service_role;
revoke execute on function public.seed_dispositions_after_tenant_insert() from public, anon, authenticated;
grant execute on function public.seed_dispositions_after_tenant_insert() to service_role;
revoke execute on function public.set_partner_user_status(uuid, text) from public, anon, authenticated;
grant execute on function public.set_partner_user_status(uuid, text) to service_role;
revoke execute on function public.update_partner_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_partner_status(uuid, text, text) to service_role;
revoke execute on function public.update_tenant_queue_sla_settings(uuid, uuid, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.update_tenant_queue_sla_settings(uuid, uuid, integer, integer, integer, integer) to service_role;
revoke execute on function public.update_verification_progress() from public, anon, authenticated;
grant execute on function public.update_verification_progress() to service_role;
revoke execute on function public.validate_outbound_provenance() from public, anon, authenticated;
grant execute on function public.validate_outbound_provenance() to service_role;
