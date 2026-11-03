-- SA-0.3 / SA-0.2 hardening.
-- Preserve audit history and the service-side write path while making the legacy
-- audit_log contract append-only at the database boundary. The newer
-- platform_audit_events table already has the same trigger; the admin UI still
-- reads audit_log, so both surfaces must have the invariant.

revoke all on table public.audit_log from public, anon, authenticated, service_role;
grant select, insert on table public.audit_log to service_role;

drop trigger if exists audit_log_append_only on public.audit_log;
create trigger audit_log_append_only
before update or delete on public.audit_log
for each row execute function public.prevent_platform_audit_mutation();

-- Tenant provisioning is an internal server-side operation. The API uses the
-- service-role adapter after it has checked super_admin; no client role should
-- be able to invoke this function directly.
revoke execute on function public.create_tenant_with_owner(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.create_tenant_with_owner(text, text, text, text)
to service_role;
