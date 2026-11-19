import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { auditCsv } from "@/lib/audit/entryView";
import { AUDIT_EXPORT_LIMIT, fetchAuditLogRows } from "@/lib/audit/logQuery";
import { parseAuditLogFilters } from "@/lib/audit/logView";

/**
 * Export CSV on /admin/audit-log (admin round 1, docs/design/admin-r1/monitoring.html screen 5): the entries the
 * list's filters match, newest first, up to AUDIT_EXPORT_LIMIT, as one CSV through the shared csvCell guard.
 * Read-only; any staff role, under the list's own per-actor rule (fetchAuditLogRows): only a super admin exports other
 * people's actions. The filters are the list's (parseAuditLogFilters); malformed values are dropped, never forwarded.
 * When more rows matched than the file holds, `X-Export-Truncated: 1` says so and the file name ends "-first-5000".
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;

  const filters = parseAuditLogFilters(request.nextUrl.searchParams, AUDIT_ACTIONS);
  try {
    const { entries, truncated } = await fetchAuditLogRows({ id: auth.session.sub, role: auth.session.role }, filters);
    const day = new Date().toISOString().slice(0, 10);
    const name = `audit-log-${day}${truncated ? `-first-${AUDIT_EXPORT_LIMIT}` : ""}.csv`;
    return new NextResponse(auditCsv(entries), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        ...(truncated ? { "X-Export-Truncated": "1" } : {}),
      },
    });
  } catch (error) {
    console.error("audit log export failed", error);
    return NextResponse.json({ error: "Could not export the audit log" }, { status: 500 });
  }
}
