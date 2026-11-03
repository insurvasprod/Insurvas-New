import { AUDIT_LOG_PAGE_SIZE } from "@/lib/audit/constants";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { fetchAuditLogPage } from "@/lib/audit/logQuery";
import { parseAuditLogFilters } from "@/lib/audit/logView";

/**
 * One page of the audit log, for /admin/audit-log's pager and filters. Read-only; any staff role.
 *
 * Filters: action, actorType (admin | tenant | system), actorId, from / to (UTC days, both
 * inclusive), target (exact target id — the `?target=` deep link), q (the search box: an action
 * code or label, or an exact target id), page. Malformed values are dropped, never forwarded.
 *
 * The per-actor rule lives in fetchAuditLogPage: only super_admin sees every actor's actions;
 * anyone else gets their own rows whatever actor filter they send.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;

  const filters = parseAuditLogFilters(request.nextUrl.searchParams, AUDIT_ACTIONS);

  try {
    const result = await fetchAuditLogPage({ id: auth.session.sub, role: auth.session.role }, filters);
    return NextResponse.json({ ...result, page: filters.page, pageSize: AUDIT_LOG_PAGE_SIZE });
  } catch (error) {
    console.error("audit log read failed", error);
    return NextResponse.json({ error: "Could not load audit log" }, { status: 500 });
  }
}
